"use client";

import { Component } from "react";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error: Error | null };

export class DashboardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8">
          <p className="text-lg text-[var(--red)]">Something went wrong rendering this page.</p>
          <p className="max-w-md text-center text-sm text-[var(--text-muted)]">
            {this.state.error?.message || "Unknown error"}
          </p>
          <button
            className="rounded-xl border border-[var(--line)] bg-[rgba(56,182,255,0.15)] px-4 py-2 text-sm text-white"
            onClick={() => this.setState({ hasError: false, error: null })}
            type="button"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
