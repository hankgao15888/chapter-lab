class FakeStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new FakeStatement(this.database, this.sql, values);
  }

  async first() {
    return this.database.first(this.sql, this.values);
  }

  async run() {
    this.database.run(this.sql, this.values);
    return {success: true};
  }
}

export class FakeD1 {
  constructor() {
    this.users = [];
    this.sessions = [];
    this.rateLimits = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    for (const statement of statements) await statement.run();
    return [];
  }

  first(sql, values) {
    if (sql.includes('SELECT 1 AS ready')) return {ready: 1};
    if (sql.includes('INSERT INTO auth_rate_limits')) {
      const [rateKey, now, cutoff] = values;
      const existing = this.rateLimits.get(rateKey);
      const attempts = !existing || existing.windowStart <= cutoff ? 1 : existing.attempts + 1;
      this.rateLimits.set(rateKey, {
        attempts,
        windowStart: !existing || existing.windowStart <= cutoff ? now : existing.windowStart
      });
      return {attempts};
    }
    if (sql.includes('SELECT id FROM users WHERE normalized_name')) {
      return this.users.find(user => user.normalized_name === values[0]) || null;
    }
    if (sql.includes('SELECT id, display_name, password_hash')) {
      return this.users.find(user => user.normalized_name === values[0]) || null;
    }
    if (sql.includes('FROM sessions') && sql.includes('JOIN users')) {
      const session = this.sessions.find(item => item.token_hash === values[0] && item.expires_at > values[1]);
      if (!session) return null;
      const user = this.users.find(item => item.id === session.user_id);
      return user ? {
        id: user.id,
        display_name: user.display_name,
        expires_at: session.expires_at
      } : null;
    }
    return null;
  }

  run(sql, values) {
    if (sql.includes('INSERT INTO users')) {
      if (this.users.some(user => user.normalized_name === values[2])) {
        throw new Error('UNIQUE constraint failed: users.normalized_name');
      }
      this.users.push({
        id: values[0],
        display_name: values[1],
        normalized_name: values[2],
        password_hash: values[3],
        password_salt: values[4],
        iterations: values[5],
        created_at: values[6],
        updated_at: values[6]
      });
      return;
    }
    if (sql.includes('DELETE FROM sessions WHERE expires_at')) {
      this.sessions = this.sessions.filter(session => session.expires_at > values[0]);
      return;
    }
    if (sql.includes('INSERT INTO sessions')) {
      this.sessions.push({
        token_hash: values[0],
        user_id: values[1],
        created_at: values[2],
        expires_at: values[3]
      });
      return;
    }
    if (sql.includes('DELETE FROM sessions WHERE token_hash')) {
      this.sessions = this.sessions.filter(session => session.token_hash !== values[0]);
    }
  }
}
