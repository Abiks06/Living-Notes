// Compiles NowPlaying.exe with the C# compiler that ships with Windows, so nothing to install.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const windows = process.env.WINDIR ?? 'C:\\Windows';
const framework = join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const metadata = join(windows, 'System32', 'WinMetadata');
const here = import.meta.dirname;

execFileSync(
  join(framework, 'csc.exe'),
  [
    '/nologo',
    '/optimize+',
    '/target:winexe',
    `/out:${join(here, 'NowPlaying.exe')}`,
    `/r:${join(metadata, 'Windows.Foundation.winmd')}`,
    `/r:${join(metadata, 'Windows.Media.winmd')}`,
    `/r:${join(metadata, 'Windows.Storage.winmd')}`,
    `/r:${join(framework, 'System.Runtime.dll')}`,
    `/r:${join(framework, 'System.Threading.Tasks.dll')}`,
    `/r:${join(framework, 'System.IO.dll')}`,
    join(here, 'NowPlaying.cs'),
  ],
  { stdio: 'inherit' },
);
