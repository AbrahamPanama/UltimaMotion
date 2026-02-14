import { Logo } from "@/components/icons";

export default function Header() {
  return (
    <header className="flex items-center gap-3 p-4 border-b">
      <div className="p-1.5 bg-primary rounded-lg text-primary-foreground">
        <Logo className="w-6 h-6" />
      </div>
      <h1 className="text-2xl font-bold font-headline tracking-tighter text-foreground">
        UltimaMotion60
      </h1>
    </header>
  );
}
