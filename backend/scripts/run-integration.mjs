import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--import','tsx','--test','test/auth.integration.test.ts'],{stdio:'inherit',env:{...process.env,RUN_DB_TESTS:'1'}});
process.exitCode=result.status??1;
