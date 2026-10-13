import ReportModal from './ReportModal.jsx'
import { reportPlace, fetchMyPlaceReports } from '../lib/apiClient.js'
import { REPORT_FIELD_LABEL } from '../data/placeSync.js'

export default function ReportPlaceModal({ open, onClose, place }) {
  return (
    <ReportModal
      open={open}
      onClose={onClose}
      name={place.name}
      fieldLabels={REPORT_FIELD_LABEL}
      fetchMine={() => fetchMyPlaceReports(place.id)}
      submit={(fields, note) => reportPlace(place.id, fields, note)}
    />
  )
}
