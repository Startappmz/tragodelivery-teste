const { createModel } = require('../lib/supabaseModel');
const { DRIVER_STATUS, DRIVER_TYPES, FINANCIAL } = require('../utils/constants');

const DriverProfile = createModel({
  name: 'DriverProfile',
  table: 'driver_profiles',
  collection: 'driverprofiles',
  mapping: {
    _id: 'id',
    id: 'id',
    user: 'user_id',
    vehicle_plate: 'vehicle_plate',
    vehicle: 'vehicle_id',
    driverType: 'driver_type',
    status: 'status',
    commissionRate: 'commission_rate',
    lastLocation: 'last_location',
    avatar_url: 'avatar_url',
    vehicle_photo_url: 'vehicle_photo_url',
    license_photo_url: 'license_photo_url',
    vehicle_brand: 'vehicle_brand',
    vehicle_model: 'vehicle_model',
    vehicle_color: 'vehicle_color',
    vehicle_type: 'vehicle_type',
    vehicle_year: 'vehicle_year',
    license_number: 'license_number',
    license_expiry: 'license_expiry',
    license_category: 'license_category',
    emergency_name: 'emergency_name',
    emergency_phone: 'emergency_phone',
    bio: 'bio',
    rating: 'rating',
    verified: 'verified',
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  defaults: {
    status: DRIVER_STATUS.OFFLINE,
    driverType: DRIVER_TYPES.FREELANCER,
    commissionRate: FINANCIAL.DEFAULT_COMMISSION_RATE,
    vehicle_plate: '',
    vehicle: null,
    lastLocation: null,
    avatar_url: '',
    vehicle_photo_url: '',
    license_photo_url: '',
    vehicle_brand: '',
    vehicle_model: '',
    vehicle_color: '',
    vehicle_type: 'mota',
    vehicle_year: null,
    license_number: '',
    license_expiry: null,
    license_category: 'A',
    emergency_name: '',
    emergency_phone: '',
    bio: '',
    rating: 4.9,
    verified: false
  },
  relations: {
    user: {
      model: () => require('./User'),
      localField: 'user',
      foreignField: '_id',
      single: true
    },
    vehicle: {
      model: () => require('./Vehicle'),
      localField: 'vehicle',
      foreignField: '_id',
      single: true
    }
  }
});

module.exports = DriverProfile;
