import os, urllib.request, json

token = os.environ.get('GITHUB_ACCESS_TOKEN')
repo = 'newgols51-pixel/studyria'

def gh(path):
    req = urllib.request.Request(f'https://api.github.com{path}')
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Accept', 'application/vnd.github.v3+json')
    req.add_header('User-Agent', 'Superagent-Worker')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def gh_patch(path, data):
    req = urllib.request.Request(
        f'https://api.github.com{path}',
        data=json.dumps(data).encode(),
        method='PATCH'
    )
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Accept', 'application/vnd.github.v3+json')
    req.add_header('Content-Type', 'application/json')
    req.add_header('User-Agent', 'Superagent-Worker')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

# Explicitly patch main ref to point to the merge commit SHA
try:
    res = gh_patch(f'/repos/{repo}/git/refs/heads/main', {
        'sha': '12dbcea7bd7025a0ae84e1aa6f6fe845b08e820e',
        'force': False
    })
    print("Main branch successfully updated to merge commit!")
    print("New main HEAD SHA:", res['object']['sha'])
except Exception as e:
    print("Error updating main branch:", e)
