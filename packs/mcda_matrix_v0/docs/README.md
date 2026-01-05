# MCDA Matrix v0 pack

This pack defines minimal data structures for MCDA (multi-criteria decision analysis) matrix scoring.

Supported in v0
- Method: WSM (Weighted Sum Model)
- Normalization: MIN_MAX
- Auto-normalize: AUTO_NORMALIZE flag
- Constraints: simple feasibility limits

Not supported in v0
- TOPSIS
- AHP

Schemas
- Alternatives, Criteria, Evaluations, Constraints
- Problem definition
- Method config (fixed WSM + MIN_MAX + AUTO_NORMALIZE)
- Score request env + score result ds
