const fs = require('fs');

const path = 'src/app/(dashboard)/contracts/ceo-dashboard.tsx';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('GroupedAmTargetsTable')) {
  code = code.replace(
    'import { cn } from "@/lib/utils";',
    'import { cn } from "@/lib/utils";\nimport { GroupedAmTargetsTable } from "./GroupedAmTargetsTable";'
  );

  const startIdx = code.indexOf('{amTargets.length === 0 ? (');
  
  if (startIdx !== -1) {
    const pre = code.substring(0, startIdx);
    const tailStr = '            </table>\n          </div>\n        )}';
    const endIdx = code.indexOf(tailStr, startIdx);
    if (endIdx !== -1) {
        const tail = code.substring(endIdx + tailStr.length);
        code = pre + '<GroupedAmTargetsTable amTargets={amTargets} copy={copy} t={t} MetricInfo={MetricInfo} fmtSR={fmtSR} />\n        ' + tail.trimStart();
        fs.writeFileSync(path, code);
        console.log("Patched successfully");
    } else {
        console.log("Could not find the end of the block");
    }
  } else {
    console.log("Start block not found");
  }
} else {
  console.log("Already patched");
}
