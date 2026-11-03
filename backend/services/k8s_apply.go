package services

import (
	"k8s.io/apimachinery/pkg/api/errors"
)

// createIgnoreExists runs fn and treats AlreadyExists as success (create-once installs).
func createIgnoreExists(fn func() error) error {
	err := fn()
	if errors.IsAlreadyExists(err) {
		return nil
	}
	return err
}

// applyCreateOrUpdate creates an object; on AlreadyExists runs onExists (typically Get+Update).
func applyCreateOrUpdate(create func() error, onExists func() error) error {
	err := create()
	if errors.IsAlreadyExists(err) {
		return onExists()
	}
	return err
}
