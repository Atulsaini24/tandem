import { parseArgs } from "node:util";
import { signToken, type Role } from "./auth.js";

/**
 * Mint an access token (development / ops). In production your app backend does this
 * after the user signs in, with the same AUTH_SECRET as the sync server.
 *
 *   AUTH_SECRET=... pnpm --filter @canvas/server token --doc demo --role viewer --user ana --hours 8
 */
const { values } = parseArgs({
  options: {
    doc: { type: "string", default: "*" },
    role: { type: "string", default: "editor" },
    user: { type: "string", default: "dev" },
    hours: { type: "string", default: "24" },
  },
});

const secret = process.env.AUTH_SECRET;
if (!secret) {
  console.error("set AUTH_SECRET (the same value the sync server uses)");
  process.exit(1);
}
if (values.role !== "editor" && values.role !== "viewer") {
  console.error("--role must be editor or viewer");
  process.exit(1);
}

const exp = Math.floor(Date.now() / 1000) + Number(values.hours) * 3600;
console.log(signToken(secret, { doc: values.doc, sub: values.user, role: values.role as Role, exp }));
