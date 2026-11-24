export function generateStaticParams() {
  return [{ studentId: '_' }]
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
