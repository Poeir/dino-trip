import ReportModal from './ReportModal.jsx'
import { reportEvent, fetchMyEventReports } from '../lib/apiClient.js'
import { EVENT_REPORT_FIELD_LABEL } from '../data/eventReports.js'

export default function ReportEventModal({ open, onClose, event }) {
  return (
    <ReportModal
      open={open}
      onClose={onClose}
      name={event.name}
      fieldLabels={EVENT_REPORT_FIELD_LABEL}
      fetchMine={() => fetchMyEventReports(event.id)}
      submit={(fields, note) => reportEvent(event.id, fields, note)}
    />
  )
}
