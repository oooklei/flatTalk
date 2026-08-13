$body = @{
  message = "帮我规划旅居路线"
  roleKey = "elder"
  userId = "test-user"
} | ConvertTo-Json
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$resp = Invoke-RestMethod -Uri "http://192.168.1.2:5299/api/chat/message" -Method POST -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 60
Write-Output "scene_key=$($resp.scene_key) intent=$($resp.intent) template_id=$($resp.template_id) routed=$($resp.routed)"
Write-Output "--- stages ---"
foreach($s in $resp.stages) {
  Write-Output "$($s.stage)|$($s.label)|$($s.detail)"
}
