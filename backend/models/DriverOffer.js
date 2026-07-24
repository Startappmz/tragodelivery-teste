const { createModel } = require('../lib/supabaseModel');

const DriverOffer = createModel({
  name: 'DriverOffer',
  table: 'driver_offers',
  collection: 'driver_offers',
  mapping: {
    _id: 'id',
    id: 'id',
    orderId: 'order_id',
    order_id: 'order_id',
    driverProfileId: 'driver_profile_id',
    driver_profile_id: 'driver_profile_id',
    status: 'status',
    selectedByRole: 'selected_by_role',
    selected_by_role: 'selected_by_role',
    selectedById: 'selected_by_id',
    selected_by_id: 'selected_by_id',
    rejectionReason: 'rejection_reason',
    rejection_reason: 'rejection_reason',
    expiresAt: 'expires_at',
    expires_at: 'expires_at',
    respondedAt: 'responded_at',
    responded_at: 'responded_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

module.exports = DriverOffer;
