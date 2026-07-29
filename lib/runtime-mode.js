export const IS_CLIENT_FACING =
  process.env.NEXT_PUBLIC_READ_ONLY === "true" ||
  process.env.NEXT_PUBLIC_CLIENT_FACING === "true" ||
  (process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_WORKSPACE_MODE !== "true");
