<#
.SYNOPSIS
  Paridad con Excel del formato 13-IF-016: escribe escenarios en una COPIA de la
  plantilla, recalcula con Excel (COM) y devuelve en JSON los valores calculados.

.DESCRIPTION
  Lo usa tests/calc.test.mjs para comparar window.Calc con las formulas reales del Excel.
  Nunca abre ni modifica el original: lo copia a una carpeta temporal.

  Entrada (JSON, UTF-8):
  {
    "hojas":      { "datos": "FORMATO ACTUALIZACION DATOS", "deducciones": "...", "validador": "..." },
    "entradas":   [ "datos!A11", "deducciones!B22", ... ],   // todas las celdas de entrada: se limpian antes de cada escenario
    "salidas":    [ "datos!AI16", "validador!BE23", ... ],   // celdas a leer despues de recalcular
    "escenarios": [ { "id": "x", "hoy": "2026-03-15" | null,
                      "celdas": { "datos!A11": 123, "datos!A16": "PEREZ", ... } } ]
  }
  - Numero JSON -> se escribe como numero; texto -> se escribe como texto (prefijo ').
  - "hoy": fija la fecha de calculo sobrescribiendo 'Validador- Datos'!BI12 y D64 (TODAY())
    en la copia; sin "hoy" se usan las formulas originales (TODAY() real).

  Salida (JSON, UTF-8 sin BOM):
  { "excel": {...}, "hoyExcel": "aaaa-mm-dd",
    "resultados": [ { "id": "x", "valores": { "datos!AI16": { "t": "s|n|b|e|v", "v": ... } } } ] }
  t: s=texto, n=numero (v como texto round-trip), b=booleano, e=error (#N/A...), v=vacia.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tests/paridad-excel.ps1 -Entrada esc.json -Salida res.json
#>
param(
  [Parameter(Mandatory = $true)][string]$Entrada,
  [Parameter(Mandatory = $true)][string]$Salida,
  [string]$Plantilla,
  [string]$DirTemporal
)

$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture

if (-not $Plantilla) {
  $raiz = Split-Path -Parent $PSScriptRoot
  $Plantilla = (Get-ChildItem -LiteralPath $raiz -Filter '13-IF-016*.xlsx' | Select-Object -First 1).FullName
}
if (-not $Plantilla -or -not (Test-Path -LiteralPath $Plantilla)) { throw "No se encontro la plantilla 13-IF-016*.xlsx" }
if (-not $DirTemporal) { $DirTemporal = Join-Path ([IO.Path]::GetTempPath()) ('paridad-13IF016-' + [Guid]::NewGuid().ToString('N')) }
New-Item -ItemType Directory -Force -Path $DirTemporal | Out-Null
$copia = Join-Path $DirTemporal ('plantilla-' + [Guid]::NewGuid().ToString('N') + '.xlsx')
Copy-Item -LiteralPath $Plantilla -Destination $copia

$spec = [IO.File]::ReadAllText($Entrada, [Text.Encoding]::UTF8) | ConvertFrom-Json

# Codigos CVErr que devuelve Value2 para errores de formula.
$errores = @{
  -2146826288 = '#NULL!'; -2146826281 = '#DIV/0!'; -2146826273 = '#VALUE!'; -2146826265 = '#REF!'
  -2146826259 = '#NAME?'; -2146826252 = '#NUM!';  -2146826246 = '#N/A'
}

function Convertir-Valor($v) {
  if ($null -eq $v) { return [ordered]@{ t = 'v'; v = $null } }
  if ($v -is [string]) { if ($v -eq '') { return [ordered]@{ t = 'v'; v = $null } } else { return [ordered]@{ t = 's'; v = $v } } }
  if ($v -is [bool]) { return [ordered]@{ t = 'b'; v = $v } }
  if ($v -is [int]) {
    if ($errores.ContainsKey($v)) { return [ordered]@{ t = 'e'; v = $errores[$v] } }
    return [ordered]@{ t = 'n'; v = ([double]$v).ToString('R', $inv) }
  }
  if ($v -is [double] -or $v -is [decimal] -or $v -is [long]) { return [ordered]@{ t = 'n'; v = ([double]$v).ToString('R', $inv) } }
  return [ordered]@{ t = 's'; v = [string]$v }
}

$xl = $null; $wb = $null; $hojas = @{}
try {
  $xl = New-Object -ComObject Excel.Application
  $xl.DisplayAlerts = $false
  $xl.Visible = $false
  $xl.ScreenUpdating = $false
  $xl.EnableEvents = $false
  $xl.AskToUpdateLinks = $false
  try { $xl.AutomationSecurity = 3 } catch {}   # msoAutomationSecurityForceDisable

  $wb = $xl.Workbooks.Open($copia, 0, $false)
  $xl.Calculation = -4135                         # xlCalculationManual mientras se escribe

  foreach ($p in $spec.hojas.PSObject.Properties) { $hojas[$p.Name] = $wb.Worksheets.Item([string]$p.Value) }

  function Rango([string]$ref) {
    $partes = $ref.Split('!')
    $ws = $hojas[$partes[0]]
    if ($null -eq $ws) { throw "Hoja desconocida en '$ref'" }
    return $ws.Range($partes[1])
  }

  function Escribir([string]$ref, $valor) {
    $r = Rango $ref
    if ($null -eq $valor -or ($valor -is [string] -and $valor -eq '')) {
      [void]$r.MergeArea.ClearContents()
    } elseif ($valor -is [string]) {
      $r.Value2 = "'" + $valor
    } elseif ($valor -is [bool]) {
      $r.Value2 = $valor
    } else {
      $r.Value2 = [double]$valor
    }
  }

  $formulaBI12 = (Rango 'validador!BI12').Formula
  $formulaD64 = (Rango 'validador!D64').Formula

  $resultados = New-Object System.Collections.ArrayList
  foreach ($esc in $spec.escenarios) {
    foreach ($ref in $spec.entradas) { Escribir $ref $null }
    if ($esc.celdas) {
      foreach ($p in $esc.celdas.PSObject.Properties) { Escribir $p.Name $p.Value }
    }
    if ($esc.hoy) {
      $serial = ([datetime]::ParseExact([string]$esc.hoy, 'yyyy-MM-dd', $inv) - [datetime]'1899-12-30').TotalDays
      (Rango 'validador!BI12').Value2 = [double]$serial
      (Rango 'validador!D64').Value2 = [double]$serial
    } else {
      (Rango 'validador!BI12').Formula = $formulaBI12
      (Rango 'validador!D64').Formula = $formulaD64
    }
    $xl.CalculateFull()

    $valores = [ordered]@{}
    foreach ($ref in $spec.salidas) { $valores[$ref] = Convertir-Valor ((Rango $ref).Value2) }
    [void]$resultados.Add([ordered]@{ id = $esc.id; hoy = $esc.hoy; valores = $valores })
  }

  $hoySerial = [double]$xl.Evaluate('TODAY()')
  $salidaObj = [ordered]@{
    excel      = [ordered]@{
      version          = [string]$xl.Version
      idiomaUI         = $xl.LanguageSettings.LanguageID(2)
      separadorDecimal = [string]$xl.International(3)
    }
    hoyExcel   = ([datetime]'1899-12-30').AddDays($hoySerial).ToString('yyyy-MM-dd', $inv)
    resultados = $resultados
  }
  $json = $salidaObj | ConvertTo-Json -Depth 8 -Compress
  [IO.File]::WriteAllText($Salida, $json, (New-Object Text.UTF8Encoding $false))
}
finally {
  if ($wb) { try { $wb.Close($false) } catch {} }
  foreach ($k in @($hojas.Keys)) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($hojas[$k]) } catch {} }
  if ($wb) { try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wb) } catch {} }
  if ($xl) { try { $xl.Quit() } catch {}; try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) } catch {} }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  try { Remove-Item -LiteralPath $copia -Force -ErrorAction Stop } catch {}
}
