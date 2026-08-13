import subprocess, base64, os

os.chdir(r'D:\GuiCare\flatTalk')

files = [
    ('geographicSVG/巴马5天4晚康养旅居-丰富版.svg', '/app/data/sojourn-maps/bama_5d4n/map_standard.svg'),
    ('geographicSVG/防城港京族滨海文化线-丰富版.svg', '/app/data/sojourn-maps/fcg_route_001/map_standard.svg'),
]

for local, remote in files:
    with open(local, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('ascii')
    
    # Split into chunks to avoid command line length limit
    chunk_size = 4000
    chunks = [b64[i:i+chunk_size] for i in range(0, len(b64), chunk_size)]
    
    # First chunk: create file
    cmd = f'echo -n "{chunks[0]}" | base64 -d > /tmp/svg_upload.b64'
    result = subprocess.run(['ssh', 'root@192.168.1.2', cmd], capture_output=True)
    
    # Remaining chunks: append
    for chunk in chunks[1:]:
        cmd = f'echo -n "{chunk}" >> /tmp/svg_upload.b64'
        result = subprocess.run(['ssh', 'root@192.168.1.2', cmd], capture_output=True)
    
    # Decode and move to container
    cmd = f'base64 -d /tmp/svg_upload.b64 > /tmp/svg_upload.svg && docker cp /tmp/svg_upload.svg flattalk2-app:{remote}'
    result = subprocess.run(['ssh', 'root@192.168.1.2', cmd], capture_output=True)
    print(f'{local} -> {remote}: exit={result.returncode}')

# Also copy bama to jtd_mock_bama_001
cmd = 'docker exec flattalk2-app cp /app/data/sojourn-maps/bama_5d4n/map_standard.svg /app/data/sojourn-maps/jtd_mock_bama_001/map_standard.svg 2>/dev/null; echo done'
result = subprocess.run(['ssh', 'root@192.168.1.2', cmd], capture_output=True)
print(f'Copy bama->jtd_mock: {result.stdout.decode("utf-8", errors="replace")}')

print('All done')