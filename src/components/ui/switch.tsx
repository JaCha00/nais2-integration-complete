import * as React from "react"
import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
    HTMLInputElement,
    React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
    <label className="relative inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-control focus-within:ring-2 focus-within:ring-ring">
        <input
            type="checkbox"
            className="peer sr-only"
            ref={ref}
            {...props}
        />
        <div className={cn(
            "h-6 w-11 rounded-full border-2 border-transparent bg-input transition-colors duration-standard",
            "peer-checked:bg-primary",
            "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
            className
        )} />
        <div className={cn(
            "pointer-events-none absolute left-0.5 top-3 h-5 w-5 rounded-full bg-background ring-1 ring-border transition-transform duration-standard",
            "peer-checked:translate-x-5"
        )} />
    </label>
))
Switch.displayName = "Switch"

export { Switch }
