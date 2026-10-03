# Abre un .xlsx generado por ExportExcel en la Vista protegida de Excel (como Excel abre un archivo
# descargado o adjunto a un correo: sin recalcular) y devuelve, en un JSON UTF-8, lo que muestran
# algunas celdas calculadas de las dos hojas visibles.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\vista-protegida.ps1 `
#     -Archivo "C:\ruta\a.xlsx" -Salida "C:\ruta\resultado.json"
#
# Codigos de salida: 0 = se proceso (revisar "ok"), 3 = Excel no disponible.
# Este archivo es solo ASCII a proposito (PowerShell 5.1 lee los .ps1 sin BOM como ANSI).
param(
  [Parameter(Mandatory = $true)][string]$Archivo,
  [Parameter(Mandatory = $true)][string]$Salida
)
$ErrorActionPreference = 'Stop'
$Archivo = [System.IO.Path]::GetFullPath($Archivo)

$celdasDatos = @('AI16', 'AH31', 'A40', 'F39', 'X40', 'AD39', 'AQ40', 'BC39', 'W46', 'AW52', 'AW53', 'C73', 'C95', 'E101', 'G102', 'F103', 'AN76', 'AY79')
$celdasDeducciones = @('J11', 'G13', 'S13', 'Z13', 'W16', 'M28', 'B31', 'W39', 'W50')

function Liberar($o) {
  if ($null -ne $o) { try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch { } }
}

function Leer($ws, $refs) {
  $r = [ordered]@{}
  foreach ($ref in $refs) {
    $c = $ws.Range($ref)
    $r[$ref] = [ordered]@{ v = $c.Value2; t = [string]$c.Text }
    Liberar $c
  }
  return $r
}

$xl = $null
$pv = $null
$res = [ordered]@{ ok = $false; error = $null }
try {
  try { $xl = New-Object -ComObject Excel.Application } catch { exit 3 }
  $xl.DisplayAlerts = $false
  $xl.Visible = $false
  $pv = $xl.ProtectedViewWindows.Open($Archivo)
  $wb = $pv.Workbook
  $datos = $null
  $ded = $null
  foreach ($h in $wb.Worksheets) {
    if ($h.Name.StartsWith('FORMATO ACTUALIZ')) { $datos = $h }
    elseif ($h.Name.StartsWith('FORMATO DEDUCC')) { $ded = $h }
  }
  $res.datos = Leer $datos $celdasDatos
  $res.deducciones = Leer $ded $celdasDeducciones
  $res.ok = $true
  Liberar $datos
  Liberar $ded
  Liberar $wb
} catch {
  $res.error = $_.Exception.Message
} finally {
  if ($null -ne $pv) { try { $pv.Close() } catch { }; Liberar $pv }
  if ($null -ne $xl) { try { $xl.Quit() } catch { }; Liberar $xl }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
[System.IO.File]::WriteAllText($Salida, ($res | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
exit 0
