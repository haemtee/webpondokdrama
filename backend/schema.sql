CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('user', 'admin') DEFAULT 'user',
    subscription_status ENUM('active', 'inactive') DEFAULT 'inactive',
    subscription_expires_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    status_before ENUM('active', 'inactive') NOT NULL,
    status_after ENUM('active', 'inactive') NOT NULL,
    expires_at_before DATETIME NULL,
    expires_at_after DATETIME NULL,
    action_type ENUM('register', 'subscribe', 'renew', 'expire', 'cancel') NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    drama_id VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    poster_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS watch_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    drama_id VARCHAR(100) NOT NULL,
    episode_id VARCHAR(100) NOT NULL,
    last_position_seconds INT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY user_episode_unique (user_id, drama_id, episode_id)
);

CREATE TABLE IF NOT EXISTS analytics_daily_stats (
    date DATE PRIMARY KEY,
    total_active_users INT DEFAULT 0,
    total_registrations INT DEFAULT 0,
    total_views INT DEFAULT 0,
    total_subscriptions_revenue_count INT DEFAULT 0
);
