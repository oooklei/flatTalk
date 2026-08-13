import subprocess
import os

os.chdir(r'D:\GuiCare\flatTalk')

files = [
    ('geographicSVG/巴马5天4晚康养旅居-丰富版.svg', '/tmp/sojourn-maps/bama_5d4n/map_standard.svg'),
    ('geographicSVG/防城港京族滨海文化线-丰富版.svg', '/tmp/sojourn-maps/fcg_route_001/map_standard.svg'),
]

for local, remote in files:
    cmd = ['scp', local, f'root@192.168.1.2:{remote}']
    result = subprocess.run(cmd, capture_output=True, text=True)
    print(f'scp {local}: exit={result.returncode}')
    if result.returncode != 0:
        print('stderr:', result.stderr)

print('Done')