"""Check and migrate DB schema for Sofia agent fields."""
import psycopg

DB_URL = "postgresql://postgres:123456@localhost:5432/omnicanal"

def main():
    conn = psycopg.connect(DB_URL)
    cur = conn.cursor()

    # Check text_agents columns
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'text_agents' ORDER BY ordinal_position"
    )
    agent_cols = [row[0] for row in cur.fetchall()]
    print("=== text_agents columns ===")
    for c in agent_cols:
        print(f"  {c}")

    # Check text_conversations columns
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'text_conversations' ORDER BY ordinal_position"
    )
    conv_cols = [row[0] for row in cur.fetchall()]
    print("=== text_conversations columns ===")
    for c in conv_cols:
        print(f"  {c}")

    # Migration: add missing columns
    migrations = []

    if "sofia_mode" not in agent_cols:
        migrations.append(
            "ALTER TABLE text_agents ADD COLUMN sofia_mode BOOLEAN NOT NULL DEFAULT FALSE"
        )
    if "sofia_config_json" not in agent_cols:
        migrations.append(
            "ALTER TABLE text_agents ADD COLUMN sofia_config_json TEXT NOT NULL DEFAULT '{}'"
        )
    if "escalation_status" not in conv_cols:
        migrations.append(
            "ALTER TABLE text_conversations ADD COLUMN escalation_status VARCHAR NOT NULL DEFAULT 'none'"
        )
    if "escalation_reason" not in conv_cols:
        migrations.append(
            "ALTER TABLE text_conversations ADD COLUMN escalation_reason VARCHAR NOT NULL DEFAULT ''"
        )
    if "escalated_at" not in conv_cols:
        migrations.append(
            "ALTER TABLE text_conversations ADD COLUMN escalated_at TIMESTAMP NULL"
        )

    if not migrations:
        print("\n--- No migrations needed, all columns exist ---")
    else:
        print(f"\n--- Running {len(migrations)} migration(s) ---")
        for sql in migrations:
            print(f"  > {sql}")
            cur.execute(sql)
        conn.commit()
        print("--- Migrations applied successfully ---")

    conn.close()

if __name__ == "__main__":
    main()
