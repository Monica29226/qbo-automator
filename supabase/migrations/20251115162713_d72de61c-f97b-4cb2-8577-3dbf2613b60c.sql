-- Crear constraint único para vendor_classification_rules
-- Esto permite hacer upsert en la tabla basado en organization_id y vendor_name
ALTER TABLE vendor_classification_rules 
DROP CONSTRAINT IF EXISTS vendor_classification_rules_org_vendor_unique;

ALTER TABLE vendor_classification_rules 
ADD CONSTRAINT vendor_classification_rules_org_vendor_unique 
UNIQUE (organization_id, vendor_name);