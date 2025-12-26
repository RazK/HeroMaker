# Backup & Recovery Guide

This document describes the backup and recovery procedures for HeroMaker.

## Backup System

### Automated Backups

Database backups are automatically created:
- **Frequency**: Daily at 2 AM UTC
- **Location**: `/app/backups/` directory in the backend container
- **Retention**: 7 days (configurable via `BACKUP_RETENTION_DAYS` environment variable)
- **Format**: `heromaker_backup_YYYYMMDD_HHMMSS.db`

### Manual Backup

You can trigger a manual backup in several ways:

#### Option 1: Via Railway CLI
```bash
railway run --service backend python backend/scripts/backup_database.py
```

#### Option 2: Via GitHub Actions
- Go to Actions → Database Backup → Run workflow

#### Option 3: Inside Container
```bash
docker-compose exec backend python /app/scripts/backup_database.py
```

### Backup Script

The backup script (`backend/scripts/backup_database.py`) performs:
1. Creates timestamped copy of the database
2. Stores backup in configured backup directory
3. Automatically cleans up backups older than retention period

### Environment Variables

- `DATABASE_PATH`: Path to database file (default: from `DATABASE_URL`)
- `BACKUP_DIR`: Directory to store backups (default: `/app/backups`)
- `BACKUP_RETENTION_DAYS`: Number of days to keep backups (default: `7`)

## Recovery Procedures

### Restore from Backup

#### Step 1: List Available Backups

```bash
# Via Railway CLI
railway run --service backend ls -lh /app/backups/

# Or via Docker
docker-compose exec backend ls -lh /app/backups/
```

#### Step 2: Stop the Application

**Important**: Stop the application before restoring to prevent data corruption.

```bash
# Via Railway: Stop the backend service temporarily
# Via Docker:
docker-compose stop backend
```

#### Step 3: Restore Database

```bash
# Via Railway CLI
railway run --service backend sh -c "cp /app/backups/heromaker_backup_YYYYMMDD_HHMMSS.db /app/heromaker.db"

# Or via Docker
docker-compose exec backend sh -c "cp /app/backups/heromaker_backup_YYYYMMDD_HHMMSS.db /app/heromaker.db"
```

#### Step 4: Verify and Restart

1. Verify the database file is restored:
   ```bash
   railway run --service backend sqlite3 /app/heromaker.db "SELECT COUNT(*) FROM creations;"
   ```

2. Restart the backend service:
   ```bash
   # Via Railway: Start the backend service
   # Via Docker:
   docker-compose start backend
   ```

### Recovery Checklist

- [ ] Identify the backup file to restore
- [ ] Stop the backend service
- [ ] Copy backup file to database location
- [ ] Verify database integrity
- [ ] Restart backend service
- [ ] Test application functionality
- [ ] Verify data is correct

## Backup Storage

### Current Setup (Railway)

Backups are stored in the Railway volume at `/app/backups/`. These persist across deployments but are tied to the service.

### Future Enhancement: External Storage

For production, consider:
- **Cloud Storage**: Upload backups to S3, Google Cloud Storage, or similar
- **Separate Backup Service**: Use a dedicated backup service
- **Database Snapshots**: Use Railway's volume snapshot feature (if available)

## Monitoring

### Check Backup Status

```bash
# List recent backups
railway run --service backend ls -lht /app/backups/ | head -10

# Check backup file size
railway run --service backend du -sh /app/backups/
```

### Verify Backup Integrity

```bash
# Check if backup is valid SQLite database
railway run --service backend sqlite3 /app/backups/heromaker_backup_YYYYMMDD_HHMMSS.db "PRAGMA integrity_check;"
```

## Troubleshooting

### Backup Fails

1. **Check disk space**:
   ```bash
   railway run --service backend df -h
   ```

2. **Check permissions**:
   ```bash
   railway run --service backend ls -ld /app/backups/
   ```

3. **Check logs**:
   - View Railway logs for backup script output
   - Check GitHub Actions logs if using scheduled backups

### Restore Fails

1. **Verify backup file exists and is readable**
2. **Check database file permissions**
3. **Ensure backend service is stopped during restore**
4. **Verify SQLite database integrity**:
   ```bash
   sqlite3 heromaker.db "PRAGMA integrity_check;"
   ```

## Best Practices

1. **Test Restores Regularly**: Periodically test restoring from backups
2. **Monitor Backup Success**: Set up alerts if backups fail
3. **Store Backups Off-Service**: Consider copying backups to external storage
4. **Document Recovery Procedures**: Keep this guide updated
5. **Version Control**: Tag database schema changes for easier recovery

## Related Documentation

- [Deployment Guide](DEPLOYMENT.md)
- [Database Schema](../backend/docs/DATABASE_SCHEMA.md)

