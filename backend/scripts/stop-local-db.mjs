import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const executable=fileURLToPath(new URL('../node_modules/@embedded-postgres/windows-x64/native/bin/pg_ctl.exe',import.meta.url));
const data=fileURLToPath(new URL('../.local/pgdata/',import.meta.url));
const result=spawnSync(executable,['-D',data,'-m','fast','-w','stop'],{stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
