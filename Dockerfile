# Build Stage
FROM node:20-alpine

# Label Info
LABEL maintainer="Prince"
LABEL description="VPS Inventory Monitor Service"

# Set Timezone to Asia/Shanghai (CST)
RUN apk add --no-cache tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone \
    && apk del tzdata

# Working Directory
WORKDIR /app

# Install Dependencies
COPY package.json ./
RUN npm install --production --no-audit

# Copy Source Code
COPY index.js ./

# Create Directories for Volume Mounting
RUN mkdir -p logs data

# Expose Health Check Port
EXPOSE 3000

# Start Application
CMD ["npm", "start"]
