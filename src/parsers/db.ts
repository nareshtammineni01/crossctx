/**
 * Database Usage Detector
 *
 * Scans source files for database access patterns and infers which tables
 * or collections each service owns/uses. Supports:
 *
 *   SQL (raw queries + ORM)
 *     TypeScript/JS: TypeORM @Entity, Prisma model, Sequelize.define, knex('table')
 *     Python:        SQLAlchemy __tablename__, Django model Meta.db_table, raw cursor.execute
 *     Go:            sqlx/database/sql — db.Query("SELECT ... FROM table")
 *     Java:          @Table(name="..."), JPA @Entity, JDBI @UseRowMapper, raw SQL
 *     C#:            EF Core [Table("...")], DbSet<T>, raw SqlCommand
 *
 *   MongoDB
 *     TypeScript:    @Schema decorator, mongoose.model("collection", ...), db.collection("name")
 *     Python:        motor/pymongo — db["collection"] or db.collection_name
 *     Go:            mongo-driver — db.Collection("name")
 *     Java:          @Document(collection="name") Spring Data MongoDB
 *     C#:            [BsonDocument], [Collection("name")]
 *
 *   Redis
 *     All languages: redis.set("key-prefix:...", ...) pattern — key prefix → logical store
 *
 *   DynamoDB
 *     All languages: TableName: "table-name" pattern in AWS SDK calls
 */

import type { DbUsage } from "../types/index.js";

export type DbLanguage = "typescript" | "python" | "go" | "java" | "csharp";

export function extractDbUsage(
  fileContents: Map<string, string>,
  language: DbLanguage,
): DbUsage[] {
  const results: DbUsage[] = [];

  for (const [filePath, content] of fileContents) {
    switch (language) {
      case "typescript":
        results.push(...extractTsDbUsage(content, filePath));
        break;
      case "python":
        results.push(...extractPyDbUsage(content, filePath));
        break;
      case "go":
        results.push(...extractGoDbUsage(content, filePath));
        break;
      case "java":
        results.push(...extractJavaDbUsage(content, filePath));
        break;
      case "csharp":
        results.push(...extractCsDbUsage(content, filePath));
        break;
    }
  }

  return deduplicateDbUsage(results);
}

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript / JavaScript
// ─────────────────────────────────────────────────────────────────────────────

function extractTsDbUsage(content: string, filePath: string): DbUsage[] {
  const usage: DbUsage[] = [];
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // TypeORM: @Entity('table_name') or @Entity()  ← class name is table
    const typeOrmEntityMatch = line.match(/@Entity\s*\(\s*(?:["']([^"']+)["'])?\s*\)/);
    if (typeOrmEntityMatch) {
      const tableName = typeOrmEntityMatch[1];
      if (tableName) {
        usage.push({ name: tableName, dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
      }
      // If no name, next class declaration tells us the name
    }

    // Prisma: model User { → table "users" (Prisma lowercases by default)
    const prismaModelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (prismaModelMatch) {
      usage.push({
        name: prismaModelMatch[1].toLowerCase() + "s",
        dbType: "sql",
        accessPattern: "orm-model",
        sourceFile: filePath,
        line: lineNum,
      });
    }

    // Sequelize: sequelize.define('tableName', ...) or Model.init({}, { tableName: '...' })
    const sequelizeDefineMatch = line.match(/(?:sequelize\.define|\.define)\s*\(\s*["']([^"']+)["']/);
    if (sequelizeDefineMatch) {
      usage.push({ name: sequelizeDefineMatch[1], dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }
    const sequelizeTableNameMatch = line.match(/tableName\s*:\s*["']([^"']+)["']/);
    if (sequelizeTableNameMatch) {
      usage.push({ name: sequelizeTableNameMatch[1], dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }

    // Knex: knex('table_name') or db('table_name')
    const knexMatch = line.match(/(?:knex|db|queryBuilder)\s*\(\s*["']([^"']+)["']\s*\)/);
    if (knexMatch && !line.includes("require") && !line.includes("import")) {
      usage.push({ name: knexMatch[1], dbType: "sql", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }

    // Raw SQL: "SELECT ... FROM table_name" or "INSERT INTO table_name"
    const rawSqlMatch = line.match(
      /["'`](?:SELECT\s+\S+.*?\s+FROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i,
    );
    if (rawSqlMatch) {
      const tbl = rawSqlMatch[1];
      if (!["users", "id", "where", "set"].includes(tbl.toLowerCase())) {
        usage.push({ name: tbl, dbType: "sql", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
      }
    }

    // Mongoose: mongoose.model('Collection', schema) or model<T>('Collection', schema)
    const mongooseModelMatch = line.match(/mongoose\.model\s*(?:<[^>]+>)?\s*\(\s*["']([^"']+)["']/);
    if (mongooseModelMatch) {
      usage.push({ name: mongooseModelMatch[1], dbType: "mongodb", accessPattern: "collection", sourceFile: filePath, line: lineNum });
    }

    // MongoDB driver: db.collection('name')
    const mongoCollectionMatch = line.match(/\.collection\s*\(\s*["']([^"']+)["']/);
    if (mongoCollectionMatch) {
      usage.push({ name: mongoCollectionMatch[1], dbType: "mongodb", accessPattern: "collection", sourceFile: filePath, line: lineNum });
    }

    // Redis: client.set("prefix:key") — extract key prefix
    const redisMatch = line.match(/(?:redis|client|redisClient)\.(?:set|get|hset|hget|lpush|rpush)\s*\(\s*["'`]([^"'`\n:]+):/);
    if (redisMatch) {
      usage.push({ name: redisMatch[1], dbType: "redis", accessPattern: "cache-key", sourceFile: filePath, line: lineNum });
    }

    // DynamoDB: TableName: 'table-name'
    const dynamoMatch = line.match(/TableName\s*:\s*["'`]([^"'`\n]+)["'`]/);
    if (dynamoMatch) {
      usage.push({ name: dynamoMatch[1], dbType: "dynamodb", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }

    // Elasticsearch: client.index({ index: 'my-index' })
    const esIndexMatch = line.match(/index\s*:\s*["'`]([^"'`\n]+)["'`]/);
    if (esIndexMatch && (content.includes("elasticsearch") || content.includes("@elastic"))) {
      usage.push({ name: esIndexMatch[1], dbType: "elasticsearch", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }
  });

  return usage;
}

// ─────────────────────────────────────────────────────────────────────────────
// Python
// ─────────────────────────────────────────────────────────────────────────────

function extractPyDbUsage(content: string, filePath: string): DbUsage[] {
  const usage: DbUsage[] = [];
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // SQLAlchemy: __tablename__ = 'table_name'
    const tableName = line.match(/^(\s*)__tablename__\s*=\s*["']([^"']+)["']/);
    if (tableName) {
      usage.push({ name: tableName[2], dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }

    // Django: class Meta: db_table = 'table_name'
    const djangoTable = line.match(/db_table\s*=\s*["']([^"']+)["']/);
    if (djangoTable) {
      usage.push({ name: djangoTable[1], dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }

    // SQLAlchemy Table(): Table('table_name', metadata, ...)
    const saTable = line.match(/Table\s*\(\s*["']([^"']+)["']/);
    if (saTable) {
      usage.push({ name: saTable[1], dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }

    // Raw SQL: cursor.execute("SELECT ... FROM table")
    const rawSqlMatch = line.match(
      /cursor\.execute\s*\(\s*["'](?:SELECT\s+\S+.*?\s+FROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i,
    );
    if (rawSqlMatch) {
      usage.push({ name: rawSqlMatch[1], dbType: "sql", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }

    // SQLAlchemy select(Model): db.query(UserModel) or select(Order)
    const queryModelMatch = line.match(/(?:session|db)\.query\s*\(\s*(\w+)\s*\)/);
    if (queryModelMatch && /^[A-Z]/.test(queryModelMatch[1])) {
      usage.push({ name: queryModelMatch[1], dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }

    // Motor / PyMongo: db["collection"] or db.collection_name
    const mongoIndexMatch = line.match(/(?:db|database)\s*\[\s*["']([^"']+)["']\s*\]/);
    if (mongoIndexMatch) {
      usage.push({ name: mongoIndexMatch[1], dbType: "mongodb", accessPattern: "collection", sourceFile: filePath, line: lineNum });
    }
    const mongoAttrMatch = line.match(/(?:db|database)\.([a-z_]\w+)\s*\.(find|insert|update|delete|aggregate)/);
    if (mongoAttrMatch) {
      usage.push({ name: mongoAttrMatch[1], dbType: "mongodb", accessPattern: "collection", sourceFile: filePath, line: lineNum });
    }

    // Redis: r.set("prefix:key") or redis_client.hset(...)
    const redisMatch = line.match(/(?:r|redis|redis_client|client)\.(set|get|hset|hget|lpush|sadd)\s*\(\s*["'f]?["']?([^"':{}\n]+):/);
    if (redisMatch) {
      usage.push({ name: redisMatch[2].trim(), dbType: "redis", accessPattern: "cache-key", sourceFile: filePath, line: lineNum });
    }

    // DynamoDB: TableName='table-name'
    const dynamoMatch = line.match(/TableName\s*=\s*["']([^"'\n]+)["']/);
    if (dynamoMatch) {
      usage.push({ name: dynamoMatch[1], dbType: "dynamodb", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }
  });

  return usage;
}

// ─────────────────────────────────────────────────────────────────────────────
// Go
// ─────────────────────────────────────────────────────────────────────────────

function extractGoDbUsage(content: string, filePath: string): DbUsage[] {
  const usage: DbUsage[] = [];
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // database/sql or sqlx: db.Query("SELECT ... FROM table") / db.Exec("INSERT INTO table")
    const sqlQueryMatch = line.match(
      /(?:db|sqlDB|conn|tx)\.(Query|QueryContext|Exec|ExecContext|QueryRow)\s*\(\s*(?:ctx\s*,\s*)?["'`](?:SELECT\s+\S+.*?\s+FROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i,
    );
    if (sqlQueryMatch) {
      usage.push({ name: sqlQueryMatch[2], dbType: "sql", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }

    // GORM: db.Table("table_name") or db.Model(&User{}).Where(...)
    const gormTableMatch = line.match(/\.Table\s*\(\s*["']([^"']+)["']/);
    if (gormTableMatch) {
      usage.push({ name: gormTableMatch[1], dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }
    // GORM model struct name lookup: db.Model(&Order{})
    const gormModelMatch = line.match(/\.Model\s*\(\s*&(\w+)\s*\{/);
    if (gormModelMatch) {
      usage.push({ name: gormModelMatch[1], dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }

    // MongoDB driver: db.Collection("name")
    const mongoCollectionMatch = line.match(/\.Collection\s*\(\s*["']([^"']+)["']/);
    if (mongoCollectionMatch) {
      usage.push({ name: mongoCollectionMatch[1], dbType: "mongodb", accessPattern: "collection", sourceFile: filePath, line: lineNum });
    }

    // Redis: rdb.Set(ctx, "prefix:key", ...)
    const redisMatch = line.match(/(?:rdb|redisClient|client)\.(?:Set|Get|HSet|HGet|LPush|SAdd)\s*\(\s*ctx\s*,\s*["']([^"':{}\n]+):/);
    if (redisMatch) {
      usage.push({ name: redisMatch[1].trim(), dbType: "redis", accessPattern: "cache-key", sourceFile: filePath, line: lineNum });
    }

    // DynamoDB: TableName: aws.String("table-name") or TableName: "table-name"
    const dynamoMatch = line.match(/TableName\s*:\s*(?:aws\.String\s*\(\s*)?["']([^"'\n]+)["']/);
    if (dynamoMatch) {
      usage.push({ name: dynamoMatch[1], dbType: "dynamodb", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }
  });

  return usage;
}

// ─────────────────────────────────────────────────────────────────────────────
// Java
// ─────────────────────────────────────────────────────────────────────────────

function extractJavaDbUsage(content: string, filePath: string): DbUsage[] {
  const usage: DbUsage[] = [];
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // JPA/Hibernate: @Table(name = "table_name") or @Table("table_name")
    const tableAnnotationMatch = line.match(/@Table\s*\(\s*(?:name\s*=\s*)?["']([^"']+)["']/);
    if (tableAnnotationMatch) {
      usage.push({ name: tableAnnotationMatch[1], dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }

    // @Entity — next class declaration gives us the entity name (lower_snake = table name)
    if (line.includes("@Entity") && !line.includes("@Table")) {
      // Look ahead for class name in next few lines
      for (let j = idx + 1; j < Math.min(idx + 4, lines.length); j++) {
        const classMatch = lines[j].match(/(?:public\s+)?class\s+(\w+)/);
        if (classMatch) {
          const entityName = classMatch[1].replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
          usage.push({ name: entityName, dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
          break;
        }
      }
    }

    // Spring MongoDB: @Document(collection = "orders")
    const mongoDocMatch = line.match(/@Document\s*\(\s*collection\s*=\s*["']([^"']+)["']/);
    if (mongoDocMatch) {
      usage.push({ name: mongoDocMatch[1], dbType: "mongodb", accessPattern: "collection", sourceFile: filePath, line: lineNum });
    }

    // JDBC: jdbcTemplate.query("SELECT ... FROM table")
    const jdbcMatch = line.match(
      /jdbcTemplate\.(?:query|update|execute)\s*\(\s*["'](?:SELECT\s+\S+.*?\s+FROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i,
    );
    if (jdbcMatch) {
      usage.push({ name: jdbcMatch[1], dbType: "sql", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }

    // DynamoDB: .tableName("table-name") or TableName.builder().tableName("table-name")
    const dynamoMatch = line.match(/\.tableName\s*\(\s*["']([^"'\n]+)["']/);
    if (dynamoMatch) {
      usage.push({ name: dynamoMatch[1], dbType: "dynamodb", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }
  });

  return usage;
}

// ─────────────────────────────────────────────────────────────────────────────
// C#
// ─────────────────────────────────────────────────────────────────────────────

function extractCsDbUsage(content: string, filePath: string): DbUsage[] {
  const usage: DbUsage[] = [];
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // EF Core: [Table("table_name")] attribute
    const tableAttrMatch = line.match(/\[Table\s*\(\s*["']([^"']+)["']/);
    if (tableAttrMatch) {
      usage.push({ name: tableAttrMatch[1], dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }

    // EF Core: DbSet<EntityType> PropertyName — entity name → table
    const dbSetMatch = line.match(/DbSet\s*<\s*(\w+)\s*>/);
    if (dbSetMatch) {
      const entityName = dbSetMatch[1];
      usage.push({ name: entityName, dbType: "sql", accessPattern: "orm-model", sourceFile: filePath, line: lineNum });
    }

    // Dapper raw SQL: connection.Query<T>("SELECT ... FROM table")
    const dapperMatch = line.match(
      /connection\.(?:Query|Execute|QueryFirst)\s*(?:<[^>]+>)?\s*\(\s*["'](?:SELECT\s+\S+.*?\s+FROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i,
    );
    if (dapperMatch) {
      usage.push({ name: dapperMatch[1], dbType: "sql", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }

    // MongoDB: [BsonDocument] or [Collection("name")]
    const mongoCollAttrMatch = line.match(/\[Collection\s*\(\s*["']([^"']+)["']/);
    if (mongoCollAttrMatch) {
      usage.push({ name: mongoCollAttrMatch[1], dbType: "mongodb", accessPattern: "collection", sourceFile: filePath, line: lineNum });
    }
    const mongoGetCollMatch = line.match(/GetCollection\s*<[^>]+>\s*\(\s*["']([^"']+)["']/);
    if (mongoGetCollMatch) {
      usage.push({ name: mongoGetCollMatch[1], dbType: "mongodb", accessPattern: "collection", sourceFile: filePath, line: lineNum });
    }

    // Redis: _cache.SetStringAsync("prefix:key", ...) or db.StringSet("prefix:key", ...)
    const redisMatch = line.match(/(?:StringSet|SetString|HashSet)\s*\(\s*["']([^"':{}\n]+):/);
    if (redisMatch) {
      usage.push({ name: redisMatch[1].trim(), dbType: "redis", accessPattern: "cache-key", sourceFile: filePath, line: lineNum });
    }

    // DynamoDB: TableName = "table-name"
    const dynamoMatch = line.match(/TableName\s*=\s*["']([^"'\n]+)["']/);
    if (dynamoMatch) {
      usage.push({ name: dynamoMatch[1], dbType: "dynamodb", accessPattern: "raw-query", sourceFile: filePath, line: lineNum });
    }
  });

  return usage;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication
// ─────────────────────────────────────────────────────────────────────────────

function deduplicateDbUsage(items: DbUsage[]): DbUsage[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.dbType}:${item.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
