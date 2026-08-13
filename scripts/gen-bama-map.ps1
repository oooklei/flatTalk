$tmpFile = "$env:TEMP\request.json"
$jsonContent = @{
    contents = @(
        @{
            role = "USER"
            parts = @(
                @{
                    text = "Create a beautiful illustrated map of Bama Yao Autonomous County in Guangxi China, showing karst mountains, Pan Yang River, Ci Fu Lake, Baimo Cave, longevity village. Vintage travel poster style with warm colors. High resolution panoramic landscape format."
                }
            )
        }
    )
    resolution = "4K"
} | ConvertTo-Json -Depth 10

$jsonContent | Set-Content -Path $tmpFile -Encoding UTF8

$response = curl.exe -s -X POST https://comate.baidu-int.com/api/aidevops/autocomate/rest/autowork/v1/generate-image `
  -H "Content-Type: application/json" `
  -H "login-name: $env:COMATE_USERNAME_ENCRYPTED" `
  -d "@$tmpFile"

$response | Out-File -FilePath "D:\GuiCare\flatTalk\.comate\images\response.json" -Encoding UTF8

$responseObj = $response | ConvertFrom-Json

if ($responseObj.candidates -and $responseObj.candidates[0].content.parts) {
    $imgPart = $responseObj.candidates[0].content.parts | Where-Object { $_.inlineData } | Select-Object -First 1
    if ($imgPart) {
        $imgBase64 = $imgPart.inlineData.data
        $outputPath = "D:\GuiCare\flatTalk\.comate\images\bama-karst-map-4k.png"
        [System.IO.File]::WriteAllBytes($outputPath, [System.Convert]::FromBase64String($imgBase64))
        Write-Output "SUCCESS: Image saved to $outputPath"
    } else {
        Write-Output "ERROR: No image data in response"
    }
} else {
    Write-Output "ERROR: Unexpected response structure"
    Write-Output $response
}