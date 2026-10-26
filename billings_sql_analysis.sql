-- 1. Create the core log table to hold the raw dataset and future predictions
CREATE TABLE cloud_billing_logs (
    id SERIAL PRIMARY KEY,
    resource_id VARCHAR(100),
    service_name VARCHAR(100),
    usage_quantity NUMERIC(18, 4),
    usage_unit VARCHAR(50),
    region_zone VARCHAR(50),
    cpu_utilization NUMERIC(5, 2),        -- Percentage (e.g., 99.56)
    memory_utilization NUMERIC(5, 2),     -- Percentage (e.g., 82.65)
    network_inbound_bytes NUMERIC(20, 2),  -- For large values like 4.44E+11
    network_outbound_bytes NUMERIC(20, 2), -- For large values like 4.45E+11
    usage_start_time TIMESTAMP,
    usage_end_time TIMESTAMP,
    cost_per_quantity NUMERIC(12, 4),
    unrounded_cost NUMERIC(15, 4),
    rounded_cost INT,
    total_cost_inr INT                    -- Target variable for ML
);

-- 2. Performance Indexes (Crucial for FastAPI dashboard queries)
CREATE INDEX idx_billing_service ON cloud_billing_logs(service_name);
CREATE INDEX idx_billing_region ON cloud_billing_logs(region_zone);
CREATE INDEX idx_billing_timestamp ON cloud_billing_logs(usage_start_time DESC);

select count(*) from cloud_billing_logs;


CREATE TABLE clean_cloud_billings (
    resource_id BIGINT,
    service_name TEXT,
    usage_quantity DOUBLE PRECISION,
    usage_unit VARCHAR(50),
    region_zone VARCHAR(100),
    cpu_utilization DOUBLE PRECISION,
    memory_utilization DOUBLE PRECISION,
    usage_start_time TIMESTAMP,
    usage_end_time TIMESTAMP,
    cost_per_quantity DOUBLE PRECISION,
    unrounded_cost DOUBLE PRECISION,
    rounded_cost BIGINT,
    total_cost_inr BIGINT,
    network_inbound_GB DOUBLE PRECISION,
    network_outbound_GB DOUBLE PRECISION
);

--Analysis

select * from clean_cloud_billings;


-- Q. Identify which cloud services are driving the highest overall expenses by filtering aggregated groups.

SELECT 
    service_name, 
    SUM(total_cost_inr) AS total_service_cost
FROM 
    clean_cloud_billings
GROUP BY 
    service_name
HAVING 
    SUM(total_cost_inr) > 1000000 
ORDER BY 
    total_service_cost DESC;

-- Q. Rank individual billing records within each region based on their total cost to spot anomalies.

SELECT 
    resource_id,
    service_name,
    region_zone,
    total_cost_inr,
    RANK() OVER (PARTITION BY region_zone ORDER BY total_cost_inr DESC) as cost_rank
FROM 
    clean_cloud_billings;

-- Q. Analyze the aggregated cost of services specifically when CPU utilization is critical (e.g., > 90%).

SELECT 
    service_name,
    COUNT(resource_id) AS high_cpu_instances,
    SUM(total_cost_inr) AS total_cost_for_high_cpu
FROM 
    clean_cloud_billings
WHERE 
    cpu_utilization > 90.0
GROUP BY 
    service_name
ORDER BY 
    total_cost_for_high_cpu DESC;


-- Q. Track how your cloud spending accumulates chronologically.

SELECT 
    usage_start_time,
    service_name,
    total_cost_inr,
    SUM(total_cost_inr) OVER (ORDER BY usage_start_time) AS cumulative_total_cost
FROM 
    clean_cloud_billings
ORDER BY 
    usage_start_time;

-- Q. Top 3 Most Expensive Resources per Region.

WITH RankedCosts AS (
    SELECT 
        resource_id,
        service_name,
        region_zone,
        total_cost_inr,
        DENSE_RANK() OVER (PARTITION BY region_zone ORDER BY total_cost_inr DESC) as cost_rank
    FROM 
        clean_cloud_billings
)
SELECT * 
FROM RankedCosts 
WHERE cost_rank <= 3;

-- Q. Categorize every billing record into one of four cost tiers (1 being the highest, 4 being the lowest)

SELECT 
    resource_id,
    service_name,
    total_cost_inr,
    NTILE(4) OVER (ORDER BY total_cost_inr DESC) AS cost_quartile
FROM 
    clean_cloud_billings;


-- Q. Cost Variation from Regional Average

SELECT 
    resource_id,
    region_zone,
    service_name,
    total_cost_inr,
    ROUND(AVG(total_cost_inr) OVER (PARTITION BY region_zone), 2) AS regional_avg_cost,
    total_cost_inr - ROUND(AVG(total_cost_inr) OVER (PARTITION BY region_zone), 2) AS deviation_from_avg
FROM 
    clean_cloud_billings;

-- Q. Shows the highest cost record for each specific service right next to every individual bill entry

SELECT 
    resource_id,
    service_name,
    total_cost_inr,
    MAX(total_cost_inr) OVER (PARTITION BY service_name) AS max_cost_for_service
FROM 
    clean_cloud_billings;

	
