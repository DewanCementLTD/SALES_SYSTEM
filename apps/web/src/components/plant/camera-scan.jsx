'use client';

// Camera QR scanning for the plant screens (TASKS P3-10, ARCHITECTURE §2: @zxing/browser). USB
// scanners keep typing into the QR field; this button opens the tablet/PC camera instead and hands
// the decoded text to the same check. Browsers allow the camera only on https or localhost.
import { Camera, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Why the camera cannot start, in words for the gate operator. */
function cameraProblem(err) {
  if (typeof window !== 'undefined' && !window.isSecureContext)
    return 'The camera works only when the system is opened over https (or on this PC as localhost). Use the USB scanner or type the number.';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser has no camera access.';
  if (err?.name === 'NotAllowedError')
    return 'Camera access was refused. Allow the camera for this site in the browser settings.';
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError')
    return 'No camera found on this device.';
  if (err?.name === 'NotReadableError' || err?.name === 'AbortError')
    return 'The camera is busy or blocked: close other programs using it (Teams, Zoom, the Camera app) and check Windows Settings › Privacy › Camera, then try again.';
  return err?.message ?? 'The camera could not be started.';
}

/**
 * @param {{ onResult: (text: string) => void, label?: string, disabled?: boolean }} p
 */
export function CameraScan({ onResult, label = 'Scan with camera', disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={label}
        title={label}
      >
        <Camera className="size-4" />
        <span className="hidden sm:inline">Camera</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Scan the QR code</DialogTitle>
            <DialogDescription>Hold the print steady in front of the camera.</DialogDescription>
          </DialogHeader>
          {open && (
            <CameraView
              onResult={(text) => {
                setOpen(false);
                onResult(text);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CameraView({ onResult }) {
  const video = useRef(null);
  const done = useRef(onResult);
  const [state, setState] = useState({ starting: true, problem: null });
  useEffect(() => {
    done.current = onResult;
  }, [onResult]);
  useEffect(() => {
    let controls = null;
    let stopped = false;
    const onScan = (result) => {
      if (!result || stopped) return;
      stopped = true;
      controls?.stop();
      done.current(result.getText());
    };
    const start = async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error('no camera'); // cameraProblem() names the reason
        const { BrowserQRCodeReader } = await import('@zxing/browser'); // loaded only when used
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
        try {
          // back camera on tablets; laptops have only the front one
          controls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' } } },
            video.current,
            onScan,
          );
        } catch (err) {
          if (stopped || err?.name === 'NotAllowedError') throw err;
          controls = await reader.decodeFromConstraints({ video: true }, video.current, onScan);
        }
        if (stopped) controls.stop();
        else setState({ starting: false, problem: null });
      } catch (err) {
        if (!stopped) setState({ starting: false, problem: cameraProblem(err) });
      }
    };
    // started a moment later: React dev mode mounts twice, and asking for the camera twice at
    // once fails on Windows ("camera busy")
    const timer = setTimeout(start, 150);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controls?.stop();
    };
  }, []);
  return (
    <div className="space-y-2">
      {state.problem ? (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.problem}
        </p>
      ) : (
        <div className="relative overflow-hidden rounded-md bg-black">
          {/* the camera picture has no audio or captions */}
          {}
          <video ref={video} className="aspect-video w-full object-cover" muted playsInline />
          {state.starting && (
            <div className="absolute inset-0 grid place-items-center text-white" role="status">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
              <span className="sr-only">Starting the camera…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
