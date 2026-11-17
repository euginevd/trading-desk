// My agents' icons (decision 70): an agent's file picks one by its job with `- Icon: <name>`.
// Each has its own tone in myagents.css, so ten agents tell apart at a glance.
const PATHS: Record<string, string> = {
  dca: "M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10.5h16M8.5 3.5v4M15.5 3.5v4M12 13v4.5M10.2 14.5h2.9a1.2 1.2 0 0 1 0 2.4h-2.6",
  grid: "M4 7h16M4 12h16M4 17h16M8 5.5v3M15 10.5v3M10.5 15.5v3",
  rebalance:
    "M12 4v15M7.5 19.5h9M5 7.5h14M5 7.5l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7.5l-2.5 6a2.5 2.5 0 0 0 5 0z",
  research:
    "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.8-4.8M7.5 12l2-2 1.5 1.5 2.3-2.7",
  news: "M5 5h10.5v14H6a1 1 0 0 1-1-1zM15.5 9H19v9a1 1 0 0 1-1 1h-2.5M8 9h4.5M8 12h4.5M8 15h3",
  risk: "M12 3.5l7 2.8V11c0 4.4-2.9 7.8-7 9.5-4.1-1.7-7-5.1-7-9.5V6.3zM9.3 12l1.9 1.9 3.6-3.9",
  tax: "M6.5 3.5h11v17l-2.2-1.4-2.2 1.4-2.2-1.4-2.2 1.4-2.2-1.4zM9.5 8h5M9.5 11.5h5M9.5 15h2.5",
  journal:
    "M5 5a1.5 1.5 0 0 1 1.5-1.5H18v14H6.5A1.5 1.5 0 0 0 5 19zM5 19a1.5 1.5 0 0 0 1.5 1.5H18v-3M9 8h5.5",
  alert: "M6.5 16v-4.5a5.5 5.5 0 0 1 11 0V16l1.5 2H5zM10 20.5a2 2 0 0 0 4 0",
  coach:
    "M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2-2.2 5.3-2.2-5.3-5.3-2.2 5.3-2.2zM18.5 17.5l.8 2 .7-2 2-.7-2-.8-.7-2-.8 2-2 .8z",
};

export default function AgentAvatar({
  icon,
  slug,
  on = false,
  size = "md",
}: {
  icon: string;
  slug: string;
  on?: boolean;
  size?: "md" | "lg";
}) {
  const path = PATHS[icon];
  return (
    <span className={`ma-ava ma-ava-${size}`} data-icon={path ? icon : "none"} aria-hidden="true">
      {path ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={path} />
        </svg>
      ) : (
        <b>{slug.slice(0, 1).toUpperCase()}</b>
      )}
      <i className={`ma-ava-state${on ? " on" : ""}`} />
    </span>
  );
}
