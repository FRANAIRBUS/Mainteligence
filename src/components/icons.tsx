import type { SVGProps } from "react";
import {
  Home,
  LayoutGrid,
  Pencil,
  ShieldCheck,
  Building2,
  Wrench,
  Database,
  Search,
  FileDown,
} from "lucide-react";

export const Icons = {
  logo: (props: SVGProps<SVGSVGElement>) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="M15.5 8.5 12 12l-3.5 3.5" />
      <path d="m8.5 8.5 7 7" />
    </svg>
  ),
  spinner: (props: SVGProps<SVGSVGElement>) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  ),
  edit: (props: SVGProps<SVGSVGElement>) => <Pencil {...props} />,
  home: (props: SVGProps<SVGSVGElement>) => <Home {...props} />,
  layout: (props: SVGProps<SVGSVGElement>) => <LayoutGrid {...props} />,
  building: (props: SVGProps<SVGSVGElement>) => <Building2 {...props} />,
  shield: (props: SVGProps<SVGSVGElement>) => <ShieldCheck {...props} />,
  wrench: (props: SVGProps<SVGSVGElement>) => <Wrench {...props} />,
  database: (props: SVGProps<SVGSVGElement>) => <Database {...props} />,
  search: (props: SVGProps<SVGSVGElement>) => <Search {...props} />,
  fileDown: (props: SVGProps<SVGSVGElement>) => <FileDown {...props} />,
};
