import { main } from "./main";

main(process.argv.slice(2), { log: (s) => console.log(s), err: (s) => console.error(s), env: process.env }).then(
  (code) => process.exit(code),
  (e) => {
    console.error((e as Error).message);
    process.exit(1);
  },
);
