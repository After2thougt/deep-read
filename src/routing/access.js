export const USER_MANAGEMENT_PATH = "/admin/users";
export const DEFAULT_LOGIN_PATH = "/";

const READING_NAVIGATION = [
  { path: "/", label: "Home", icon: "home" },
  { path: "/articles", label: "Articles", icon: "articles" },
  { path: "/vocabulary", label: "Vocabulary", icon: "vocabulary" },
  { path: "/highlight", label: "Highlight", icon: "highlight" },
];

export function getNavigationItems(role) {
  return role === "administrator"
    ? [
        { path: "/", label: "Home", icon: "home" },
        { path: USER_MANAGEMENT_PATH, label: "User Management", icon: "users" },
      ]
    : READING_NAVIGATION;
}

export function getRoleRedirect(role, pathname) {
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  if (role === "administrator") {
    return pathname === "/" || pathname === USER_MANAGEMENT_PATH ? null : "/";
  }
  return isAdminPath ? "/" : null;
}
