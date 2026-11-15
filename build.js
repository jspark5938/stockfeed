// 웹 화면 파일을 안드로이드 앱에 넣을 www 폴더로 복사합니다.
const fs = require("fs");
fs.rmSync("www", { recursive: true, force: true });
fs.mkdirSync("www/app", { recursive: true });
fs.copyFileSync("index.html", "www/index.html");
for (const f of fs.readdirSync("app")) fs.copyFileSync("app/" + f, "www/app/" + f);
console.log("www 폴더 준비 완료");
