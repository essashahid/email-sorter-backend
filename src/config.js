import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const resolveFromRoot = (relativePath) => path.resolve(rootDir, relativePath);

export const config = {
  port: Number(process.env.PORT) || 5001,
  credentialsPath: resolvePath(process.env.CREDENTIALS_PATH || "credentials.json"),
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  maxEmails: Number(process.env.MAX_EMAILS) || 50,
  classificationStorePath: resolvePath(
    process.env.CLASSIFICATION_STORE || "data/classifications.json"
  ),
  userStorePath: resolvePath(process.env.USER_STORE || "data/users.json"),
  sessionSecret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
  isProduction: process.env.NODE_ENV === "production",
};

function resolvePath(relativePath) {
  return path.isAbsolute(relativePath)
    ? relativePath
    : resolveFromRoot(relativePath);
}
