const appJson = require("./app.json");

const resolvedPortRaw = process.env.EXPO_PUBLIC_SERVER_PORT ?? process.env.SERVER_PORT ?? "8080";
const resolvedPort = Number.parseInt(String(resolvedPortRaw), 10);
const serverPort = Number.isInteger(resolvedPort) && resolvedPort > 0 ? resolvedPort : 8080;

const defaultApiBaseUrl = `http://10.0.2.2:${serverPort}`;

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...(appJson.expo.extra ?? {}),
      serverPort,
      apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? defaultApiBaseUrl,
      wsBaseUrl: process.env.EXPO_PUBLIC_WS_BASE_URL ?? "",
    },
  },
};