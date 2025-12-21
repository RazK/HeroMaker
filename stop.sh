#!/bin/bash
# Stop all services
docker-compose -f docker-compose.yml -f docker-compose.dev.yml down
