import Link from "next/link";
import styles from "../payment-status.module.css";

export default function PaymentSuccess() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <span className={`${styles.badge} ${styles.badgeSuccess}`}>Payment Success</span>
        <h1 className={styles.title}>Payment Confirmed</h1>
        <p className={styles.copy}>
          Enrollment is complete and your session is now active. A confirmation
          email will arrive shortly with your membership details.
        </p>
        <p className={styles.note}>
          If you are still on the live call, tell the representative payment has
          already gone through.
        </p>
        <div className={styles.actions}>
          <Link className={styles.solidButton} href="/">
            Return to Home
          </Link>
          <Link className={styles.ghostButton} href="/payment-cancelled">
            View Cancelled State
          </Link>
        </div>
      </section>
    </main>
  );
}
