# Sync model-service.js and restart remote

$localFile = "D:\GuiCare\flatTalk\src\core\model-service.js"
$remotePath = "/tmp/model-service.js"
$containerPath = "/app/src/core/model-service.js"

# Copy to remote
scp $localFile "root@192.168.1.2:$remotePath"

# Copy into container
ssh root@192.168.1.2 "docker cp $remotePath flattalk2-app:$containerPath"

# Restart container
ssh root@192.168.1.2 "docker restart flattalk2-app"

Write-Output "Done. Wait 10s then check health..."
Start-Sleep -Seconds 10

# Health check
ssh root@192.168.1.2 "curl -s http://localhost:5299/api/health"