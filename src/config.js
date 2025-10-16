import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import os from "os";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const resolveFromRoot = (relativePath) => path.resolve(rootDir, relativePath);

// Use /tmp on Vercel (serverless) because /var/task is read-only
function getWritablePath(defaultPath) {
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), path.basename(defaultPath));
  }
  return defaultPath;
}

export const config = {
  port: Number(process.env.PORT) || 5000,
  credentialsPath: resolvePath(
    process.env.CREDENTIALS_PATH || "credentials.json"
  ),
  tokenPath: resolvePath(process.env.TOKEN_PATH || "token.json"),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  maxEmails: Number(process.env.MAX_EMAILS) || 50,

  // ✅ Automatically switches to /tmp on Vercel
  classificationStorePath: getWritablePath(
    resolvePath(process.env.CLASSIFICATION_STORE || "data/classifications.json")
  ),
};

function resolvePath(relativePath) {
  return path.isAbsolute(relativePath)
    ? relativePath
    : resolveFromRoot(relativePath);
}
