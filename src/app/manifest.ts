import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Constructly — Construction ERP",
    short_name: "Constructly",
    description:
      "Manage projects, labor, procurement, and vendors from one beautiful place.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#fbfbfd",
    theme_color: "#2e5bff",
    icons: [
      { src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
    ],
  };
}
