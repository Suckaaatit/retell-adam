import Link from "next/link";
import styles from "../payment-status.module.css";

export default function PaymentCancelled() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <span className={`${styles.badge} ${styles.badgeCancelled}`}>
          Payment Not Completed
        </span>
        <h1 className={styles.title}>Checkout Session Closed</h1>
        <p className={styles.copy}>
          No charge was made. You can resume enrollment anytime with a fresh
          secure link from the sales assistant.
        </p>
        <p className={styles.note}>
          If this was accidental, return to your call and request another payment
          link.
        </p>
        <div className={styles.actions}>
          <Link className={styles.solidButton} href="/">
            Back to Home
          </Link>
          <Link className={styles.ghostButton} href="/payment-success">
            View Success State
          </Link>
        </div>
      </section>
    </main>
  );
}
