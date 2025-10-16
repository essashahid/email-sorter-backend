import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import os from "os";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function resolveFromRoot(relativePath) {
  if (!relativePath)
    throw new Error("resolveFromRoot called with undefined path");
  return path.resolve(rootDir, relativePath);
}

function resolvePath(relativePath) {
  if (!relativePath)
    throw new Error("resolvePath called with undefined path");
  return path.isAbsolute(relativePath)
    ? relativePath
    : resolveFromRoot(relativePath);
}

// ✅ Use /tmp on Vercel since /var/task is read-only
function getWritablePath(filePath) {
  if (!filePath)
    throw new Error("getWritablePath called with undefined filePath");
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), path.basename(filePath));
  }
  return filePath;
}

export const config = {
  port: Number(process.env.PORT) || 5000,
  credentialsPath: resolvePath(process.env.CREDENTIALS_PATH || "credentials.json"),
  tokenPath: resolvePath(process.env.TOKEN_PATH || "token.json"),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  maxEmails: Number(process.env.MAX_EMAILS) || 50,

  // ✅ Automatically writable path for Vercel
  classificationStorePath: getWritablePath(
    resolvePath(process.env.CLASSIFICATION_STORE || "data/classifications.json")
  ),
  userStorePath: getWritablePath(
    resolvePath(process.env.USER_STORE || "data/users.json")
  ),
};

// Optional: log actual paths for debugging
console.log("Classification store path:", config.classificationStorePath);
console.log("User store path:", config.userStorePath);
