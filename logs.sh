#!/bin/bash
# View logs (follow mode)
docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f
