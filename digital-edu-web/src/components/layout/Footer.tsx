export default function Footer() {
  return (
    <footer
      style={{
        borderTop: '1px solid var(--border)',
        padding: '32px 20px',
        textAlign: 'center',
      }}
    >
      <p style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
        DigitalEdu &mdash; Competency-Based Learning Platform
      </p>
    </footer>
  );
}
