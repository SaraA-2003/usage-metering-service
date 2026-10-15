import "dotenv/config";
import process from "node:process";


type APIConfig = {
  port: number;
  platform: string;
};

type DBConfig = {
  url: string;
};
type Config ={
    api: APIConfig;
  db: DBConfig;  
}
export const config: Config = {
  api: {
    port: Number(envOrThrow("PORT")),
    platform: envOrThrow("PLATFORM"),
  },
  db: {
    url: envOrThrow("DB_URL"),
  },
};


function envOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}