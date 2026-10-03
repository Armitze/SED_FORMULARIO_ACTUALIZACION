# Abre uno o varios .xlsx generados por ExportExcel en Excel (COM), detecta si Excel tuvo
# que repararlos, recalcula y devuelve (en un archivo JSON UTF-8) los valores de las celdas
# calculadas y la estructura del libro (hojas, tablas, validaciones, imagenes, proteccion)
# para compararla con la plantilla original.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\verificar-export.ps1 `
#     -Archivos "C:\ruta\a.xlsx|C:\ruta\b.xlsx" -Salida "C:\ruta\resultado.json" [-CopiaDir "C:\ruta"]
# (varios archivos separados por "|": con -File PowerShell no convierte "a,b" en arreglo)
#
# Deteccion de reparacion: con DisplayAlerts=false, Workbooks.Open LANZA si el archivo necesita
# reparacion (probado con XML danado) -> ok=false; ademas se buscan registros nuevos %TEMP%\error*.xml
# (reparado=true) y se compara la estructura con la plantilla. Con -CopiaDir se guarda una copia
# (SaveCopyAs) para confirmar que Excel puede escribir el libro.
#
# Codigos de salida: 0 = se proceso todo (revisar "ok" de cada archivo), 3 = Excel no disponible.
# Este archivo es solo ASCII a proposito (PowerShell 5.1 lee los .ps1 sin BOM como ANSI).
param(
  [Parameter(Mandatory = $true)][string[]]$Archivos,
  [Parameter(Mandatory = $true)][string]$Salida,
  [string]$CopiaDir = ''
)
$ErrorActionPreference = 'Stop'
$Archivos = @($Archivos | ForEach-Object { $_ -split '\|' } | Where-Object { $_ -ne '' } | ForEach-Object { [System.IO.Path]::GetFullPath($_) })

# Celdas a leer despues de recalcular. 'D' = hoja de datos, 'R' = hoja de deducciones.
$celdasDatos = @('AI16', 'A14', 'AH31', 'A40', 'F39', 'X40', 'AD39', 'AQ40', 'BC39', 'W46', 'AW52', 'AW53', 'H53',
  'C73', 'C91', 'C95', 'E101', 'G102', 'F103', 'F47', 'AN11', 'AN13', 'AA11', 'P21', 'AI21', 'BB21', 'M31', 'AE31',
  'AN32', 'AG26', 'AQ26', 'AN76', 'AY79', 'A24', 'A11', 'P11', 'AC11', 'AP11', 'K46', 'A50', 'AC46', 'AN46', 'Q50')
# Celdas de entrada cuyo formato/validacion/bloqueo se compara con la plantilla.
$celdasMuestraDatos = @('A11', 'P11', 'AC11', 'A24', 'AG24', 'AN31', 'A39', 'X39', 'F46', 'K46', 'AC46', 'AN46', 'V50', 'Q50', 'BA61', 'S82', 'I85')
$celdasMuestraDeducciones = @('B22', 'U22', 'B25', 'Y37', 'J40', 'G62', 'L54')
$celdasDeducciones = @('J11', 'G13', 'S13', 'Z13', 'W16', 'M28', 'B31', 'W39', 'W50', 'B42', 'B57', 'AC25', 'B22', 'J40', 'L54')

function Liberar($o) {
  if ($null -ne $o) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch { } }
}

function Buscar-Hoja($wb, [string]$prefijo) {
  foreach ($ws in $wb.Worksheets) {
    if ($ws.Name.StartsWith($prefijo)) { return $ws }
  }
  return $null
}

function Leer-Celdas($ws, [string[]]$refs) {
  $r = [ordered]@{}
  foreach ($ref in $refs) {
    $c = $ws.Range($ref)
    $v = $c.Value2
    $t = $c.Text
    $r[$ref] = [ordered]@{ valor = $v; texto = [string]$t; formula = [bool]$c.HasFormula }
    Liberar $c
  }
  return $r
}

function Registros-Reparacion() {
  # Excel deja un registro "error*.xml" en %TEMP% cuando repara un libro.
  $lista = @()
  try { $lista = @(Get-ChildItem -Path $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) } catch { }
  return $lista
}

$xl = $null
try {
  try {
    $xl = New-Object -ComObject Excel.Application
  } catch {
    $json = (@{ sinExcel = $true; error = $_.Exception.Message } | ConvertTo-Json -Depth 4)
    [System.IO.File]::WriteAllText($Salida, $json, (New-Object System.Text.UTF8Encoding($false)))
    exit 3
  }
  $xl.DisplayAlerts = $false
  $xl.Visible = $false
  $xl.ScreenUpdating = $false
  $xl.AskToUpdateLinks = $false
  try { $xl.AutomationSecurity = 3 } catch { }

  $resultados = @()
  foreach ($archivo in $Archivos) {
    $res = [ordered]@{ archivo = $archivo; ok = $false; reparado = $false; error = $null }
    $wb = $null
    $antes = Registros-Reparacion
    try {
      $wb = $xl.Workbooks.Open($archivo, 0, $true)
      $xl.CalculateFull()

      $despues = Registros-Reparacion
      $nuevos = @($despues | Where-Object { $antes -notcontains $_ })
      $res.reparado = ($nuevos.Count -gt 0)
      $res.registrosReparacion = $nuevos

      $hojas = @()
      $tablas = 0; $imagenes = 0; $comentarios = 0
      foreach ($ws in $wb.Worksheets) {
        $hojas += [ordered]@{ nombre = $ws.Name; visible = [int]$ws.Visible; protegida = [bool]$ws.ProtectContents }
        $tablas += $ws.ListObjects.Count
        $imagenes += $ws.Shapes.Count
        $comentarios += $ws.Comments.Count
        Liberar $ws
      }

      $wsDatos = Buscar-Hoja $wb 'FORMATO ACTUALIZ'
      $wsDed = Buscar-Hoja $wb 'FORMATO DEDUCC'
      if ($null -eq $wsDatos -or $null -eq $wsDed) { throw 'No se encontraron las hojas del formulario.' }

      # Muestras de validaciones de datos, formatos y bloqueo de celdas (deben ser iguales a la plantilla).
      $muestras = [ordered]@{}
      foreach ($par in @(@('D', $wsDatos, $celdasMuestraDatos), @('R', $wsDed, $celdasMuestraDeducciones))) {
        foreach ($ref in $par[2]) {
          $c = $par[1].Range($ref)
          $tipoVal = -1
          try { $tipoVal = [int]$c.Validation.Type } catch { $tipoVal = -1 }
          $muestras[$par[0] + '!' + $ref] = [ordered]@{ validacion = $tipoVal; formato = [string]$c.NumberFormat; bloqueada = [bool]$c.Locked }
          Liberar $c
        }
      }

      $res.estructura = [ordered]@{
        hojas = $hojas
        tablas = $tablas
        imagenes = $imagenes
        comentarios = $comentarios
        estructuraProtegida = [bool]$wb.ProtectStructure
        nombresDefinidos = $wb.Names.Count
        muestras = $muestras
      }

      $res.datos = Leer-Celdas $wsDatos $celdasDatos
      $res.deducciones = Leer-Celdas $wsDed $celdasDeducciones
      Liberar $wsDatos; Liberar $wsDed

      if ($CopiaDir -ne '') {
        $copia = Join-Path $CopiaDir ([System.IO.Path]::GetFileNameWithoutExtension($archivo) + '.excel.xlsx')
        $wb.SaveCopyAs($copia)
        $res.copia = $copia
      }
      $res.ok = $true
    } catch {
      $res.error = $_.Exception.Message
    } finally {
      if ($null -ne $wb) { try { $wb.Close($false) } catch { }; Liberar $wb }
    }
    $resultados += $res
  }

  $json = (@{ sinExcel = $false; resultados = $resultados } | ConvertTo-Json -Depth 8)
  [System.IO.File]::WriteAllText($Salida, $json, (New-Object System.Text.UTF8Encoding($false)))
} finally {
  if ($null -ne $xl) {
    try { $xl.Quit() } catch { }
    Liberar $xl
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
exit 0
