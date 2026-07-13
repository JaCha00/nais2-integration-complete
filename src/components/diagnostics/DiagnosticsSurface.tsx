import { DiagnosticDrawer } from './DiagnosticDrawer'
import { DiagnosticToastBridge } from './DiagnosticToastBridge'

export function DiagnosticsSurface() {
    return (
        <>
            <DiagnosticToastBridge />
            <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-3 z-40 sm:bottom-4 sm:left-4">
                <DiagnosticDrawer />
            </div>
        </>
    )
}
