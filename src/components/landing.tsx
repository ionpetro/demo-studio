"use client";

import { SignUpButton } from "@clerk/nextjs";
import { VideoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StudioHeader } from "@/components/studio-header";

/** Signed-out home: one hero, one demo video, one call to action. */
export function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-background dark:bg-bg-deep">
      <StudioHeader />

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center gap-10 px-6 py-14 text-center">
        <div className="hero-rise flex flex-col items-center gap-4">
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            <span className="rec-dot size-1.5 rounded-full bg-rec" />
            cloud agent recorder
          </span>
          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Product walkthroughs,
            <br />
            filmed by an agent.
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Describe the flow. Loopa storyboards it, drives a real browser on camera in the cloud,
            and hands you a captioned cut on a shareable link.
          </p>
          <SignUpButton>
            <Button size="lg" className="mt-2">
              <VideoIcon /> start looping
            </Button>
          </SignUpButton>
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
            free · works from chat or your agent
          </span>
        </div>

        <video
          className="hero-rise w-full rounded-2xl border shadow-[0_0_80px_-20px_oklch(0_0_0/40%)]"
          style={{ animationDelay: "140ms" }}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/demo/loopa-demo-poster.jpg"
          src="/demo/loopa-demo-1600.mp4"
          aria-label="Demo: Loopa turns a chat request into a recorded browser walkthrough on a shareable page"
        />
      </main>
    </div>
  );
}
