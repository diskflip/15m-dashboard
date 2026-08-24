import { useEffect, useState } from "react";
import { connectToBackend } from "../data/kalshi";

export function useWallet(): { balanceCents: number | null } {
  const [balanceCents, setBalanceCents] = useState<number | null>(null);

  useEffect(() => {
    const disconnect = connectToBackend((msg) => {
      if (msg.type === "wallet") setBalanceCents(msg.balanceCents);
    }, () => {});

    return disconnect;
  }, []);

  return { balanceCents };
}
