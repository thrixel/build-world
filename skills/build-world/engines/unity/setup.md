# Unity setup

#### Install Unity CLI to allow agents to control Unity

MacOS or Linux install:
```
curl -fsSL https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.sh | UNITY_CLI_CHANNEL=beta bash
```
Windows install:
```
$env:UNITY_CLI_CHANNEL='beta'; irm https://public-cdn.cloud.unity3d.com/hub/prod/cli/install.ps1 | iex
```

#### Create a Unity Project
Determine if a Unity project exists in this folder (look for `Assets/`, `Packages/manifest.json`, `ProjectSettings/`). If not, create a Unity URP project:

##### Option A: Clone the built-in URP template (preferred)

1. Get the installed Editor path:
```
   unity editors -i --format json
```
   Use the newest installed version. `<EDITOR>` below is its install path.

2. Locate the Universal 3D template tarball inside the Editor install:
   - macOS: `<EDITOR>/Unity.app/Contents/Resources/PackageManager/ProjectTemplates/com.unity.template.universal-3d-*.tgz`
   - Windows/Linux: `<EDITOR>/Editor/Data/Resources/PackageManager/ProjectTemplates/com.unity.template.universal-3d-*.tgz`

3. Create the project headlessly:
```
   "<EDITOR_BINARY>" -createProject "<ABSOLUTE_PROJECT_PATH>" -cloneFromTemplate "<TGZ_PATH>" -batchmode -quit
```
   (`<EDITOR_BINARY>` is `Unity.app/Contents/MacOS/Unity` on macOS, `Editor\Unity.exe` on Windows.)

4. Verify: `Packages/manifest.json` must contain `com.unity.render-pipelines.universal`. If it does, skip Option B.

##### Option B: Manual scaffold (fallback if the template tgz is missing or verification fails)

1. In the project folder, create:
   - `Assets/` (empty)
   - `Packages/manifest.json`:
```json
     {
       "dependencies": {
         "com.unity.render-pipelines.universal": "17.0.3",
         "com.unity.ugui": "2.0.0",
         "com.unity.test-framework": "1.4.5"
       }
     }
```
     (Match the URP major version to the Editor version; check with `unity editors -i`. Unity 6 = URP 17.x.)
